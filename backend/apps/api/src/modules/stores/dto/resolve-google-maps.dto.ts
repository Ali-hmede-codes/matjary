import { IsString, Length } from 'class-validator';

export class ResolveGoogleMapsDto {
  @IsString()
  @Length(10, 1000)
  url!: string;
}
