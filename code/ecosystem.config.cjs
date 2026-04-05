module.exports = {
  apps: [{
    name: 'gaia-bot',
    script: 'dist/index.js',
    cwd: __dirname,
    max_restarts: 5,
    restart_delay: 5000,
    kill_timeout: 10000,
    env: {
      NODE_ENV: 'production',
      SERVICE_NAME: 'gaia-bot',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    }
  }]
};
