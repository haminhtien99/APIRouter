const COLORS = { reset: "\x1b[0m", green: "\x1b[32m" };

async function getEndpoint(port) {
  return { endpoint: `http://127.0.0.1:${port}/v1`, tunnelEnabled: false };
}

async function getEndpointColored(port) {
  return `${COLORS.green}http://127.0.0.1:${port}/v1${COLORS.reset}`;
}

module.exports = { getEndpoint, getEndpointColored };
