import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createSilhouetteSignal,
  silhouetteDivergence,
  silhouetteHints,
} from "@/lib/audioscope/silhouette";
import { spectrumToAxes } from "@/lib/audioscope/spectrogram";
import { AUDIOSCOPE_CATEGORIES, emptyScores, type CategoryScores } from "@/lib/audioscope";
import SemanticScope from "@/components/visuals/SemanticScope";

const invoke = vi.fn();
const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));

function scores(overrides: Partial<CategoryScores> = {}): CategoryScores {
  return { ...emptyScores(), emotional: 70, communication: 60, artistic: 40, ...overrides };
}

describe("zero-audio silhouette", () => {
  it("is deterministic for identical scores and tags", () => {
    const tags = [{ code: "aset.speech", weight: 0.8 }, { code: "iab.iab1", weight: 0.4 }];
    const a = createSilhouetteSignal({ scores: scores(), tags, seed: "subj" });
    const b = createSilhouetteSignal({ scores: scores(), tags, seed: "subj" });
    const bufA = new Float32Array(64);
    const bufB = new Float32Array(64);
    a.waveform(bufA, 1.5);
    b.waveform(bufB, 1.5);
    expect(Array.from(bufA)).toEqual(Array.from(bufB));
  });

  it("differs when the tag mix differs but axes are identical", () => {
    const a = createSilhouetteSignal({
      scores: scores(),
      tags: [{ code: "aset.speech", weight: 0.9 }],
      seed: "subj",
    });
    const b = createSilhouetteSignal({
      scores: scores(),
      tags: [{ code: "aset.music", weight: 0.9 }],
      seed: "subj",
    });
    const bufA = new Float32Array(64);
    const bufB = new Float32Array(64);
    a.waveform(bufA, 1.5);
    b.waveform(bufB, 1.5);
    expect(Array.from(bufA)).not.toEqual(Array.from(bufB));
  });

  it("reads speech-heavy subjects as brighter and slower", () => {
    const speech = silhouetteHints(scores({ communication: 95, artistic: 5 }), []);
    const music = silhouetteHints(scores({ communication: 5, artistic: 95 }), []);
    expect(speech.spectralCentroid!).toBeGreaterThan(music.spectralCentroid! * 0.5);
    expect(speech.tempo!).toBeLessThan(music.tempo!);
  });

  it("flags the axes that carry the divergence", () => {
    const { axes, similarity } = silhouetteDivergence(
      scores({ emotional: 90, cognitive: 10 }),
      scores({ emotional: 20, cognitive: 12 }),
    );
    const emotional = axes.find((a) => a.category === "emotional")!;
    const cognitive = axes.find((a) => a.category === "cognitive")!;
    expect(emotional.divergent).toBe(true);
    expect(cognitive.divergent).toBe(false);
    expect(similarity).toBeLessThan(100);
  });

  it("maps spectrum bands onto the six ontology axes", () => {
    const spec = new Float32Array(60).fill(0);
    spec.fill(1, 0, 10); // lowest band only
    const axes = spectrumToAxes(spec, AUDIOSCOPE_CATEGORIES);
    expect(axes.emotional).toBe(100);
    expect(axes.artistic).toBe(0);
  });
});

describe("SemanticScope", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 5, error: null });
    invoke.mockResolvedValue({
      data: {
        success: true,
        tags: [{ id: "1", code: "aset.speech", label: "Speech", similarity: 0.82 }],
      },
      error: null,
    });
  });

  it("renders all three lenses with an in-panel legend", async () => {
    render(<SemanticScope scores={scores()} seed="s1" staticFrame={1.25} playing={false} />);
    expect(screen.getByText(/Frequency lens/i)).toBeInTheDocument();
    expect(screen.getByText(/Meaning lens/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scrolling spectrogram/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /legend/i }));
    expect(screen.getByText(/Time lens/i)).toBeInTheDocument();
  });

  it("labels a zero-audio subject as a silhouette", () => {
    render(<SemanticScope scores={scores()} seed="s2" staticFrame={1.25} playing={false} tags={[{ code: "aset.speech", weight: 0.7 }]} />);
    expect(screen.getByText(/expected sonic silhouette/i)).toBeInTheDocument();
  });

  it("hides the debug lens outside the admin lens", async () => {
    const { rerender } = render(
      <SemanticScope scores={scores()} seed="s3" staticFrame={1.25} playing={false} lens="consumer" />,
    );
    expect(screen.queryByRole("button", { name: /debug/i })).toBeNull();

    rerender(<SemanticScope scores={scores()} seed="s3" staticFrame={1.25} playing={false} lens="debug" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /debug/i })).toBeInTheDocument());
  });

  it("does not score while paused or static", async () => {
    render(<SemanticScope scores={scores()} seed="s4" staticFrame={1.25} playing={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(invoke).not.toHaveBeenCalled();
  });
});
