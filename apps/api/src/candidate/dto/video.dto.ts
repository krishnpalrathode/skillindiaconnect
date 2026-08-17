import { IsInt, IsNumber, IsString, Max, Min } from 'class-validator';

/**
 * Outer bounds only. The real ceilings are Settings
 * (`candidates.video_max_mb` / `candidates.video_max_minutes`) and are applied
 * in VideoService, because an admin can change them without a deploy and a
 * decorator cannot read the database.
 *
 * These exist so a nonsense request — a negative length, a gigabyte — is
 * rejected as a 400 at the pipe rather than reaching the service and being
 * turned into a 422 about a limit it never came close to.
 */
const ABSOLUTE_MAX_BYTES = 100 * 1024 * 1024;
const ABSOLUTE_MAX_SECONDS = 2 * 60 * 60;

export class PresignVideoDto {
  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(ABSOLUTE_MAX_BYTES)
  sizeBytes!: number;

  /**
   * Length in seconds, as the browser measured it.
   *
   * `IsNumber` rather than `IsInt`: `HTMLVideoElement.duration` is fractional
   * (a 92.4-second clip is normal), and rounding client-side before sending
   * would just be a second place the value could be got wrong. It is rounded
   * once, on write.
   */
  @IsNumber()
  @Min(1)
  @Max(ABSOLUTE_MAX_SECONDS)
  durationSec!: number;
}

export class ConfirmVideoDto {
  @IsString()
  key!: string;

  @IsNumber()
  @Min(1)
  @Max(ABSOLUTE_MAX_SECONDS)
  durationSec!: number;
}
