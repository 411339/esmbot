import process from "node:process";
import Command from "#cmd-classes/command.js";
// import { reload } from "#utils/soundplayer.js";

class SoundReloadCommand extends Command {
  async run() {
    // Music/Lavalink features are not supported on Fluxer yet
    return "Music features are not yet supported on Fluxer.";

  static description = "Attempts to reconnect to all available Lavalink nodes";
  static aliases = ["lava", "lavalink", "lavaconnect", "soundconnect"];
  static adminOnly = true;
}

export default SoundReloadCommand;
