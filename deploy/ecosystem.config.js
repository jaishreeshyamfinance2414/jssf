// pm2 process definitions — backend API and Next.js frontend.
module.exports = {
  apps: [
    {
      name: 'jssf-api',
      cwd: `${process.env.HOME}/jssf/backend`,
      script: 'dist/server.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      time: true,
    },
    {
      name: 'jssf-web',
      cwd: `${process.env.HOME}/jssf/frontend`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      time: true,
    },
  ],
};
