import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Mail, Trash2, UserPlus, Users } from 'lucide-react';
import { dateLabel, getJson, mutate, panelError } from '../shared/panel-api';
import { Empty, Loading, Notice, PageTitle, Retry } from '../shared/PanelUI';
import { useWebsiteSettings } from '../../hooks/useWebsiteSettings';
import { useOwner } from './OwnerPanel';

interface TeamMember {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface TeamInvitation {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

interface TeamResponse {
  storeId: string;
  members: TeamMember[];
  invitations: TeamInvitation[];
  maxMembers: number;
}

interface InviteResult {
  status: 'added' | 'invited';
  member?: TeamMember;
  invitation?: TeamInvitation;
}

interface InviteDraft {
  email: string;
  message: string;
  gmailUrl: string;
}

function inviteMessage(
  storeName: string,
  email: string,
  siteName: string,
): string {
  const origin = window.location.origin;
  return [
    `Hi!`,
    ``,
    `You're invited to help with ${storeName} on ${siteName}.`,
    ``,
    `Sign in at ${origin}/login using the Google account for ${email}. The invitation will be waiting in your studio.`,
    ``,
    `You can add and edit products, posts, and stories for the shop.`,
  ].join('\n');
}

function gmailComposeUrl(
  email: string,
  storeName: string,
  siteName: string,
): string {
  const subject = `Help with ${storeName} on ${siteName}`;
  const body = inviteMessage(storeName, email, siteName);
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function TeamPanel() {
  const { store, session } = useOwner();
  const { settings } = useWebsiteSettings(false);
  const siteName = settings.siteName;
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<InviteDraft | null>(null);
  const query = useQuery({
    queryKey: ['panel', session.user.id, 'team', store?.id],
    queryFn: ({ signal }) =>
      getJson<TeamResponse>(
        `stores/${encodeURIComponent(store!.slug)}/team`,
        signal,
      ),
    enabled: Boolean(store),
  });

  if (!store)
    return (
      <Empty title="Choose a shop first">
        <p>Team access belongs to one shop at a time.</p>
      </Empty>
    );
  if (query.isPending) return <Loading />;
  if (query.isError)
    return <Retry error={query.error} retry={() => void query.refetch()} />;

  const team = query.data;
  const used = team.members.length + team.invitations.length;

  function showError(e: unknown) {
    setNotice('');
    setError(panelError(e));
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError('');
      setNotice(`${label} copied. Paste it into a message to send.`);
    } catch {
      setError('Could not copy automatically. Select the text and copy it.');
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setDraft(null);
    try {
      const result = await mutate<InviteResult>(
        `stores/${encodeURIComponent(store!.slug)}/team`,
        { email: address },
      );
      await query.refetch();
      if (result.status === 'added' && result.member) {
        setNotice(`${result.member.displayName} now has access to this shop.`);
      } else if (result.invitation) {
        const target = result.invitation.email;
        setDraft({
          email: target,
          message: inviteMessage(store!.name, target, siteName),
          gmailUrl: gmailComposeUrl(target, store!.name, siteName),
        });
        setNotice(
          `Invitation ready for ${target}. Send it to their Gmail address.`,
        );
      }
      setEmail('');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: TeamMember) {
    if (
      !window.confirm(
        `Remove ${member.displayName} from ${store!.name}? They lose access immediately.`,
      )
    )
      return;
    setRemoving(member.id);
    setError('');
    setNotice('');
    try {
      await mutate(
        `stores/${encodeURIComponent(store!.slug)}/team/members/${member.id}`,
        {},
        'DELETE',
      );
      setNotice(`${member.displayName} no longer has access.`);
      await query.refetch();
    } catch (e) {
      showError(e);
    } finally {
      setRemoving('');
    }
  }

  async function cancelInvitation(invitation: TeamInvitation) {
    if (!window.confirm(`Cancel the invitation for ${invitation.email}?`))
      return;
    setRemoving(invitation.id);
    setError('');
    setNotice('');
    try {
      await mutate(
        `stores/${encodeURIComponent(store!.slug)}/team/invitations/${invitation.id}`,
        {},
        'DELETE',
      );
      setNotice('Invitation cancelled.');
      await query.refetch();
    } catch (e) {
      showError(e);
    } finally {
      setRemoving('');
    }
  }

  function draftFor(invitation: TeamInvitation): InviteDraft {
    return {
      email: invitation.email,
      message: inviteMessage(store!.name, invitation.email, siteName),
      gmailUrl: gmailComposeUrl(invitation.email, store!.name, siteName),
    };
  }

  return (
    <>
      <PageTitle
        eyebrow="YOUR SHOP TEAM"
        title="Let people help."
        description="Add someone you trust to manage products, posts, and stories with you."
      />
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}

      <section className="panel-card panel-team-invite">
        <div>
          <h2>
            <UserPlus size={20} /> Add a team member
          </h2>
          <p className="panel-muted">
            Type the exact Gmail address of the Google account they will use.
            The field never suggests or auto-fills addresses.
          </p>
        </div>
        <form onSubmit={invite} autoComplete="off">
          <label>
            Their Gmail address
            <input
              type="email"
              name="team-member-email"
              // No saved-address suggestions: the owner types the full Gmail.
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              placeholder="name@gmail.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
            />
          </label>
          <button
            type="submit"
            className="panel-primary"
            disabled={busy || !email.trim()}
          >
            {busy ? 'Checking…' : 'Add or invite'}
          </button>
        </form>
        <p className="panel-muted">
          If they already have a {siteName} account, access starts right away.
          Otherwise the invitation waits for them after they sign in with that
          Google account.
        </p>
        {draft && (
          <div className="panel-invite-draft">
            <strong>Send this to {draft.email}</strong>
            <textarea
              aria-label="Invitation message"
              readOnly
              value={draft.message}
              rows={6}
            />
            <div className="panel-team-actions">
              <button
                type="button"
                className="panel-secondary"
                onClick={() => void copy(draft.message, 'Invitation message')}
              >
                <Copy size={16} /> Copy message
              </button>
              <a
                className="panel-primary"
                href={draft.gmailUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Mail size={16} /> Open Gmail
              </a>
            </div>
          </div>
        )}
      </section>

      <div className="panel-two-columns panel-team-columns">
        <section className="panel-card">
          <h2>
            <Users size={20} /> People with access
          </h2>
          {team.members.length ? (
            <ul className="panel-team-list">
              {team.members.map((member) => (
                <li key={member.id} className="panel-team-row">
                  <div className="panel-team-identity">
                    <span className="panel-avatar">
                      {member.displayName.slice(0, 1) || 'M'}
                    </span>
                    <div>
                      <strong>{member.displayName}</strong>
                      <small>
                        {member.email} · Joined {dateLabel(member.joinedAt)}
                      </small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="panel-secondary"
                    disabled={removing === member.id}
                    onClick={() => void removeMember(member)}
                  >
                    <Trash2 size={15} />
                    {removing === member.id ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-muted">
              No one else has access yet. Invite someone above.
            </p>
          )}
          <div className="panel-usage">
            <span>Team spots used</span>
            <strong>
              {used} / {team.maxMembers}
            </strong>
          </div>
        </section>

        <section className="panel-card">
          <h2>What team members can do</h2>
          <ul className="panel-team-permissions">
            <li>Add and edit products</li>
            <li>Create and edit posts</li>
            <li>Share and delete stories</li>
          </ul>
          <p className="panel-muted">
            Only you can change shop settings, design, plan, or boost. Only you
            can invite or remove people, and only you can delete the shop.
          </p>
        </section>
      </div>

      {team.invitations.length > 0 && (
        <section className="panel-card">
          <h2>Waiting to accept</h2>
          <p className="panel-muted">
            These people have not signed in with the invited Gmail account yet.
            Invitations expire after a week.
          </p>
          <ul className="panel-team-list">
            {team.invitations.map((invitation) => {
              const preview = draftFor(invitation);
              return (
                <li key={invitation.id} className="panel-team-row">
                  <div>
                    <strong>{invitation.email}</strong>
                    <small>
                      Invited · expires {dateLabel(invitation.expiresAt)}
                    </small>
                  </div>
                  <div className="panel-team-actions">
                    <button
                      type="button"
                      className="panel-secondary"
                      onClick={() =>
                        void copy(preview.message, 'Invitation message')
                      }
                    >
                      <Copy size={15} /> Copy
                    </button>
                    <a
                      className="panel-secondary"
                      href={preview.gmailUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Mail size={15} /> Gmail
                    </a>
                    <button
                      type="button"
                      className="panel-secondary"
                      disabled={removing === invitation.id}
                      onClick={() => void cancelInvitation(invitation)}
                    >
                      {removing === invitation.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
