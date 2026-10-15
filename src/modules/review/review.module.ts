import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { ReviewRepository } from './review.repository';
import { DatabaseService } from '../../db/database.service';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, ReviewRepository, DatabaseService],
  exports: [ReviewService],
})
export class ReviewModule {}
