import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { CacheService } from "./cache.service.js";

@Global()
@Module({
    providers: [PrismaService, CacheService],
    exports: [PrismaService, CacheService]
})

export class DatabaseModule { }