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
  /** Shows the stream (sets the video's source and plays it). Throws if it can't. */
  attach: (stream: MediaStream) => Promise<void>;
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
      try {
        await deps.attach(stream);
      } catch (error) {
        stopTracks(stream);
        if (mine !== generation) return "cancelled";
        pending = false;
        deps.detach();
        return { error, stage: "playback" };
      }
      if (mine !== generation) {
        stopTracks(stream);
        return "cancelled";
      }
      pending = false;
      current = stream;
      return "started";
    },
    /** Stops the camera and cancels any start still waiting. */
    stop() {
      generation++;
      pending = false;
      if (current) stopTracks(current);
      current = null;
      deps.detach();
    },
  };
}
