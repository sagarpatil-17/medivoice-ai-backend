import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { CacheService } from "./cache.service.js";

@Module({
    providers: [PrismaService, CacheService],
    exports: [PrismaService, CacheService]
})

export class DatabaseModule { }