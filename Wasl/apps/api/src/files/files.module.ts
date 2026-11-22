import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { OBJECT_STORE, openObjectStore } from './object-store';

@Global()
@Module({ controllers: [FileController], providers: [FileService, { provide: OBJECT_STORE, inject: [ConfigService], useFactory: openObjectStore }], exports: [FileService, OBJECT_STORE] })
export class FilesModule {}
