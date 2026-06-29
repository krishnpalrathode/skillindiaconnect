import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class SettingUpdateItemDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  // Value is validated against the per-key declared type in SettingsService.set,
  // not here — class-validator cannot know the per-key type at decoration time.
  value!: unknown;
}

export class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingUpdateItemDto)
  updates!: SettingUpdateItemDto[];
}
