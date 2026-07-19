import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BlockId, isSolid } from "../world/blocks";
import { WorldGenerator } from "../world/generator-types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "world-data");

interface EditRecord {
  block: BlockId;
}

/**
 * Headless (no chunking/meshing/GPU) world model for the server: just enough
 * to answer point queries for mob physics and to authoritatively validate +
 * persist block edits. Reuses the exact same deterministic generator the
 * client uses, so both sides agree on unedited terrain without transmitting
 * it — only the edit log needs to cross the wire (V.5: "all modifications...
 * must be synchronized ... and persistent even after reloading").
 */
export class WorldStore {
  private edits = new Map<string, EditRecord>();
  private filePath: string;

  constructor(
    private generator: WorldGenerator,
    fileName: string,
  ) {
    this.filePath = join(DATA_DIR, fileName);
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as [string, EditRecord][];
      this.edits = new Map(raw);
    } catch (err) {
      console.error(`Failed to load ${this.filePath}:`, err);
    }
  }

  private save(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.edits.entries()]));
    } catch (err) {
      console.error(`Failed to save ${this.filePath}:`, err);
    }
  }

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    const edit = this.edits.get(this.key(x, y, z));
    if (edit) return edit.block;
    return this.generator.getBlockAt(x, y, z);
  }

  isSolidAt(x: number, y: number, z: number): boolean {
    return isSolid(this.getBlock(x, y, z));
  }

  setBlock(x: number, y: number, z: number, block: BlockId): void {
    this.edits.set(this.key(x, y, z), { block });
    this.save();
  }

  allEdits(): { x: number; y: number; z: number; block: BlockId }[] {
    return [...this.edits.entries()].map(([key, rec]) => {
      const [x, y, z] = key.split(",").map(Number) as [number, number, number];
      return { x, y, z, block: rec.block };
    });
  }
}
