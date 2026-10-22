export class EngagementResponseDto {
  likes!: number;
  views!: number;
  /** Whether the current viewer (logged-in user or visitor) has liked this post. */
  viewerLiked!: boolean;
}

export class ToggleLikeDto {
  liked!: boolean;
  likes!: number;
}

export class RegisterViewDto {
  views!: number;
}
