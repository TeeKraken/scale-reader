/**
 * Starting and stopping the camera safely. Only one start can be pending, and
 * every stop (button, page hidden, switching to a photo, saving) cancels a
 * pending start: if permission or the camera answers later, that stream's
 * tracks are stopped straight away instead of being shown or left running.
 */

/** `stage` says whether asking for the camera failed, or showing its picture did. */
export type StartResult = "started" | "busy" | "cancelled" | { error: unknown; stage: "permission" | "playback" };

export interface CameraDeps {
  getUserMedia: () => Promise<MediaStream>;
  /**
   * Shows the stream (sets the video's source and plays it). Throws if it can't.
   * Must give up, cleaning up its listeners and timers, when `signal` aborts.
   */
  attach: (stream: MediaStream, signal: AbortSignal) => Promise<void>;
  /** Clears the video. */
  detach: () => void;
}

export function stopTracks(stream: MediaStream) {
  for (const t of stream.getTracks()) t.stop();
}

export function createCamera(deps: CameraDeps) {
  let generation = 0;
  let pending = false;
  let current: MediaStream | null = null;
  /** A stream we have but that isn't showing yet, with the means to abandon showing it. */
  let attaching: { stream: MediaStream; abort: AbortController } | null = null;

  return {
    get running() {
      return current !== null;
    },
    get pending() {
      return pending;
    },
    async start(): Promise<StartResult> {
      if (pending || current) return "busy";
      pending = true;
      const mine = ++generation;
      let stream: MediaStream;
      try {
        stream = await deps.getUserMedia();
      } catch (error) {
        if (mine !== generation) return "cancelled";
        pending = false;
        return { error, stage: "permission" };
      }
      if (mine !== generation) {
        stopTracks(stream);
        return "cancelled";
      }
      const abort = new AbortController();
      attaching = { stream, abort };
      try {
        await deps.attach(stream, abort.signal);
      } catch (error) {
        stopTracks(stream);
        // Cancelled meanwhile: stop() already cleaned up, and a newer start may own the video now.
        if (mine !== generation) return "cancelled";
        attaching = null;
        pending = false;
        deps.detach();
        return { error, stage: "playback" };
      }
      if (mine !== generation) {
        stopTracks(stream);
        return "cancelled";
      }
      attaching = null;
      pending = false;
      current = stream;
      return "started";
    },
    /** Stops the camera at once, including one that's still waiting for permission or starting up. */
    stop() {
      generation++;
      pending = false;
      if (attaching) {
        stopTracks(attaching.stream);
        attaching.abort.abort();
        attaching = null;
      }
      if (current) stopTracks(current);
      current = null;
      deps.detach();
    },
  };
}
