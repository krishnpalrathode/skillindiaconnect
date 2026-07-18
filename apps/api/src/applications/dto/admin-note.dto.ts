import { IsString, Length } from 'class-validator';

export class CreateNoteDto {
  /** Internal note body — admin-only, capped per the contract (2000 chars). */
  @IsString()
  @Length(1, 2000)
  body!: string;
}
