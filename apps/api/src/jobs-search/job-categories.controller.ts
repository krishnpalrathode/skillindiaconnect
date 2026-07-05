/**
 * Public job-categories enumeration.
 *
 * GET /job-categories — unauthenticated; feeds the public search filter chips and
 * the employer job-post category picker. A separate route (not /jobs/categories)
 * so it never collides with GET /jobs/:id.
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { JobsSearchService } from './jobs-search.service';

@Controller('job-categories')
export class JobCategoriesController {
  constructor(private readonly searchService: JobsSearchService) {}

  @Get()
  @Public()
  async list() {
    return { data: await this.searchService.listCategories() };
  }
}
