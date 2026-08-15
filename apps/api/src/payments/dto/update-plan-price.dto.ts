import { IsInt, Max, Min } from 'class-validator';
import { PLAN_PRICE_MAX_SUBUNITS } from '../admin-plans.service';

/**
 * A plan's new price, in INTEGER SUBUNITS (paise).
 *
 * Subunits rather than rupees for the same reason every other amount in this
 * codebase is: 2999.99 in a float is not 2999.99, and a rounding error in a
 * price is a rounding error on every invoice that price produces. The admin UI
 * shows rupees and converts once, at the edge.
 *
 * The structural rules — Free stays free, a paid plan keeps a price — are NOT
 * here. They depend on the row being edited, which a DTO cannot see, so they
 * live in `AdminPlansService.updatePrice`.
 */
export class UpdatePlanPriceDto {
  @IsInt()
  @Min(0)
  @Max(PLAN_PRICE_MAX_SUBUNITS)
  priceSubunits!: number;
}
