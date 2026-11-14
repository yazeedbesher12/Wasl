// A database-independent developer entry point, using the real guards/services.
// This is NOT a production identity bypass; production mode is rejected by configuration.
process.env.WASL_STORAGE_DRIVER = 'memory';
void import('./main');
