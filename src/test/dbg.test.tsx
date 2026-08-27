import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import AudioscopeCompare from "@/components/visuals/AudioscopeCompare";
import SonicSimPanel from "@/components/visuals/SonicSimPanel";
import { AUDIOSCOPE_CATEGORIES, type CategoryScores } from "@/lib/audioscope";
const scores = AUDIOSCOPE_CATEGORIES.reduce((a,c,i)=>{a[c]=40+i*8;return a;},{} as CategoryScores);
beforeEach(()=>{cleanup();vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(null);});
describe("dbg",()=>{it("x",()=>{
render(<div><SonicSimPanel subjects={[{id:"1",label:"L",scores}]}/><AudioscopeCompare entities={[{id:"a",label:"A",color:"#14b8a6",scores},{id:"b",label:"B",color:"#f59e0b",scores}]} similarity={72}/></div>);
const c = document.querySelector("#audioscope-compare-static-toggle") as HTMLElement;
const sib = c.parentElement?.querySelector("button:not(#audioscope-compare-static-toggle)") as HTMLElement;
console.log("sib id", sib?.id, sib?.textContent, c.parentElement?.tagName);
sib.focus(); console.log("active", (document.activeElement as HTMLElement).id, document.activeElement?.textContent?.slice(0,20));
expect(1).toBe(1);
});});
