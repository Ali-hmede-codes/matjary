import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'admin_audit_log', engine: 'InnoDB' })
@Index('idx_admin_audit_created', ['createdAt', 'id'])
@Index('idx_admin_audit_resource', ['resource', 'resourceId', 'createdAt'])
export class AdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_id', type: 'varchar', length: 36 })
  actorId!: string;

  @Column({ type: 'varchar', length: 80 })
  action!: string;

  @Column({ type: 'varchar', length: 40 })
  resource!: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 100 })
  resourceId!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 36 })
  requestId!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  // Field names only: audit history must not become a second secret store.
  @Column({ name: 'changed_fields', type: 'json' })
  changedFields!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;
}

export enum SystemErrorState {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

@Entity({ name: 'system_errors', engine: 'InnoDB' })
@Index('uq_system_errors_fingerprint', ['fingerprint'], { unique: true })
@Index('idx_system_errors_seen', ['lastSeenAt', 'id'])
export class SystemErrorRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 16 })
  service!: string;

  @Column({ type: 'varchar', length: 100 })
  operation!: string;

  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: string;

  @Column({
    type: 'enum',
    enum: SystemErrorState,
    default: SystemErrorState.OPEN,
  })
  state!: SystemErrorState;

  @Column({ type: 'bigint', unsigned: true, default: '1' })
  occurrences!: string;

  @Column({ name: 'request_ids', type: 'json' })
  requestIds!: string[];

  @Column({ name: 'first_seen_at', type: 'datetime', precision: 6 })
  firstSeenAt!: Date;

  @Column({ name: 'last_seen_at', type: 'datetime', precision: 6 })
  lastSeenAt!: Date;
}
