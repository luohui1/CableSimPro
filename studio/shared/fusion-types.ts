// What the Agent page shows of the platform's own saved runs. The numbers are the saved run's, read from the platform when the agent
// read the run (a saved run never changes); the model is never the source of one.
export interface SavedRunView {
  /** The study and the record: 城南线路 · 110 kV 直埋单回校核 · 第 51 条记录. */
  title: string;
  /** How far the method is validated for the configuration that was actually computed. */
  tier: 'deliverable' | 'reference';
  /** The method's name and version, never its plugin identifier: IEC 60287 载流量 1.2.0. */
  method: string;
  /** The allowed current, formatted: 748.3. */
  current: string;
  /** What the current means, in the producer's words: 全回路共同能力. */
  basis: string;
  /** Where the record stands against the project's present inputs. */
  freshness: 'current' | 'historical' | 'unknown';
  limiting: {
    /** The cable that reaches its limit first: 回路 1 · A 相. */
    name: string;
    /** Conductor temperature at the saved load, its limit and the ambient, in °C; a value the record does not give is null. */
    conductor: number | null;
    limit: number | null;
    ambient: number | null;
    /** The saved load and the margin to the allowed current, formatted with units; null when the record does not give them. */
    load: string | null;
    margin: string | null;
  };
}
