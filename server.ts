import { createApp } from './src/app.ts';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = await createApp();

  app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `JaliCare HMIS server running on http://0.0.0.0:${PORT}`
      );
    }
  );
}

startServer().catch((err) => {
  console.error(
    'Fatal server startup error:',
    err
  );

  process.exit(1);
});
