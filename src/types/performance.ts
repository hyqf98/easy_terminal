export type MetricAvailability = 'available' | 'partial' | 'unavailable';

export interface MetricStatus { state: MetricAvailability; reason?: string | null }
export interface CpuMetric { usagePercent: number; cores: number }
export interface MemoryMetric { total: number; used: number; usagePercent: number }
export interface DiskMetric { name: string; mountPoint: string; total: number; used: number; available: number }
export interface GpuMetric { name: string; utilizationPercent?: number | null; memoryTotal?: number | null; memoryUsed?: number | null }
export interface PortMetric { protocol: string; address: string; port: number; process?: string | null; pid?: number | null }
export interface ProcessMetric { pid: number; name: string; cpuPercent: number; memory: number }
export interface PerformanceSnapshot {
  capturedAt: number;
  cpu: CpuMetric;
  memory: MemoryMetric;
  disks: DiskMetric[];
  gpus: GpuMetric[];
  ports: PortMetric[];
  /** True when port collection was capped to protect the monitoring UI. */
  portsTruncated: boolean;
  processes: ProcessMetric[];
  gpuStatus: MetricStatus;
  portsStatus: MetricStatus;
  processesStatus: MetricStatus;
}
