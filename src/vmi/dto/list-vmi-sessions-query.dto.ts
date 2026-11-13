import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

function queryInteger(value: unknown): unknown {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
}

export class ListVmiSessionsQueryDto {
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  offset = 0;
}
