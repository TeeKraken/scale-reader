import { describe, expect, it, vi } from "vitest";
import { createCamera } from "./camera";

function fakeStream() {
  const tracks = [{ readyState: "live", stop() { this.readyState = "ended"; } }];
  return { getTracks: () => tracks, tracks } as unknown as MediaStream & { tracks: { readyState: string }[] };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const requests: ReturnType<typeof deferred<MediaStream>>[] = [];
  const attach = vi.fn(async () => {});
  const detach = vi.fn();
  const camera = createCamera({
    getUserMedia: () => {
      const d = deferred<MediaStream>();
      requests.push(d);
      return d.promise;
    },
    attach,
    detach,
  });
  return { camera, requests, attach, detach };
}

describe("camera", () => {
  it("allows only one pending start", async () => {
    const { camera, requests } = setup();
    const first = camera.start();
    expect(await camera.start()).toBe("busy");
    expect(requests).toHaveLength(1);
    const s = fakeStream();
    requests[0].resolve(s);
    expect(await first).toBe("started");
    expect(await camera.start()).toBe("busy");
    camera.stop();
    expect(s.tracks[0].readyState).toBe("ended");
  });

  it("stops a stream that arrives after Stop (late permission)", async () => {
    const { camera, requests, attach } = setup();
    const p = camera.start();
    camera.stop();
    expect(camera.pending).toBe(false);
    const late = fakeStream();
    requests[0].resolve(late);
    expect(await p).toBe("cancelled");
    expect(late.tracks[0].readyState).toBe("ended");
    expect(attach).not.toHaveBeenCalled();
    expect(camera.running).toBe(false);
  });

  it("a stale start can't take over after a newer one", async () => {
    const { camera, requests } = setup();
    const old = camera.start();
    camera.stop();
    const fresh = camera.start();
    const a = fakeStream();
    const b = fakeStream();
    requests[1].resolve(b);
    expect(await fresh).toBe("started");
    requests[0].resolve(a);
    expect(await old).toBe("cancelled");
    expect(a.tracks[0].readyState).toBe("ended");
    expect(b.tracks[0].readyState).toBe("live");
    camera.stop();
    expect(b.tracks[0].readyState).toBe("ended");
  });

  it("stops the stream and reports an error when it can't be shown", async () => {
    const { camera, requests, attach, detach } = setup();
    attach.mockRejectedValueOnce(new Error("play failed"));
    const p = camera.start();
    const s = fakeStream();
    requests[0].resolve(s);
    expect(await p).toMatchObject({ error: expect.any(Error), stage: "playback" });
    expect(s.tracks[0].readyState).toBe("ended");
    expect(detach).toHaveBeenCalled();
    expect(camera.pending).toBe(false);
    expect(camera.running).toBe(false);
  });

  it("reports a refused permission and can try again", async () => {
    const { camera, requests } = setup();
    const p = camera.start();
    requests[0].reject(new DOMException("no", "NotAllowedError"));
    expect(await p).toMatchObject({ error: expect.anything(), stage: "permission" });
    expect(camera.pending).toBe(false);
    const again = camera.start();
    expect(requests).toHaveLength(2);
    camera.stop();
    requests[1].resolve(fakeStream());
    expect(await again).toBe("cancelled");
  });
});
