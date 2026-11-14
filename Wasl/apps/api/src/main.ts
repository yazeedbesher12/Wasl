import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { abortOnError: false, logger: ['log', 'warn'] });
  app.enableShutdownHooks();
  configureApp(app);

  const swagger = new DocumentBuilder()
    .setTitle('Wasl API')
    .setDescription('Multi-school learning platform API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`Wasl API on http://localhost:${port}/api/v1 (docs at /api/docs)`);
}
void bootstrap().catch(() => {
  // Do not print raw driver errors, configuration values, URLs or credential-bearing objects.
  console.error('Wasl API startup failed. Check the Phase 1 configuration and storage setup guide.');
  process.exitCode = 1;
});
