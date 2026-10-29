module.exports = {
  apps: [{
    name: "sonechka-bot",
    script: "index.js",
    node_args: "--env-file=.env",
    autorestart: true,
  }],
};
