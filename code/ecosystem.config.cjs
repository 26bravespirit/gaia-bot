module.exports = {
  apps: [{
    name: 'persona-bot',
    script: 'dist/index.js',
    cwd: __dirname,
    instances: 1,               // 强制单实例
    exec_mode: 'fork',          // fork 模式（不是 cluster）
    max_restarts: 5,
    restart_delay: 5000,
    kill_timeout: 10000,        // 等 10s 让 shutdown handler 跑完
    treekill: true,             // 杀进程时连带杀整个子进程树
    listen_timeout: 8000,
    shutdown_with_message: true, // 发 shutdown message 而非直接 SIGKILL
    env: {
      NODE_ENV: 'production',
      SERVICE_NAME: 'persona-bot',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    }
  }]
};
