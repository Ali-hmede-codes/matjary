import { IsString, Length, Matches } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  @Length(1, 8192)
  @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  credential!: string;
}
