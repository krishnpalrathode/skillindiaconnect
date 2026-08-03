import { IsString } from 'class-validator';

/** Confirm a completed photo upload by the key returned from presign. */
export class ConfirmPhotoDto {
  @IsString()
  key!: string;
}
