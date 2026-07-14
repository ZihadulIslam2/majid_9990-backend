module.exports = {
  apps: [
    {
      name: "majid-backend",
      cwd: __dirname,
      script: "dist/server.js",
      env: {
        NODE_ENV: "production",
        PORT: "5000",
      },
    },
  ],
};
