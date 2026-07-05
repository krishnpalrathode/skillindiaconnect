import { Type } from 'class-transformer';
import { Allow, IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class SettingUpdateItemDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  // Value is validated against the per-key declared type in SettingsService.set,
  // not here — class-validator cannot know the per-key type at decoration time.
  // @Allow() is REQUIRED: the global ValidationPipe runs `whitelist: true`, which
  // strips any property without a validation decorator — without this, `value`
  // would be silently dropped and every settings update would fail as undefined.
  @Allow()
  value!: unknown;
}

export class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingUpdateItemDto)
  updates!: SettingUpdateItemDto[];
}
