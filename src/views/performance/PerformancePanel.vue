<template>
  <section class="performance-panel" @mousedown.stop @wheel.stop>
    <header class="performance-panel-header">
      <div class="performance-heading">
        <span class="performance-target">{{ targetLabel }}</span>
        <strong>{{ t('perf.title') }}</strong>
        <small>{{ snapshot ? capturedAtLabel : t('perf.loading') }}</small>
      </div>
      <div class="performance-actions">
        <button class="performance-action" :data-tooltip="t('perf.refresh')" @click="refreshNow" aria-label="Refresh">↻</button>
        <button class="performance-action" :data-tooltip="t('perf.close')" @click="emit('close')" aria-label="Close">×</button>
      </div>
    </header>
    <div v-if="!snapshot && !error" class="performance-empty">
      <i></i><i></i><i></i><span>{{ t('perf.loading') }}</span>
    </div>
    <div v-else-if="!snapshot" class="performance-stale performance-notice">{{ error }}</div>
    <template v-else-if="snapshot">
      <div v-if="error" class="performance-stale performance-notice">{{ t('perf.stale') }} · {{ error }}</div>
      <div class="performance-summary" aria-label="CPU and memory summary">
        <article class="performance-metric">
          <div class="metric-heading"><span>{{ t('perf.cpu') }}</span><small v-if="snapshot.cpu.cores">{{ snapshot.cpu.cores }} cores</small></div>
          <strong>{{ percent(snapshot.cpu.usagePercent) }}</strong>
          <div class="performance-meter"><i :style="{ width: `${Math.min(100, snapshot.cpu.usagePercent)}%` }"></i></div>
        </article>
        <article class="performance-metric performance-memory-metric">
          <div class="metric-heading"><span>{{ t('perf.memory') }}</span><small>{{ bytes(snapshot.memory.used) }} / {{ bytes(snapshot.memory.total) }}</small></div>
          <strong>{{ percent(snapshot.memory.usagePercent) }}</strong>
          <div class="performance-meter"><i :style="{ width: `${Math.min(100, snapshot.memory.usagePercent)}%` }"></i></div>
        </article>
      </div>
      <section class="performance-section">
        <header class="performance-section-header"><h4>{{ t('perf.disk') }}</h4><span>{{ snapshot.disks.length }}</span></header>
        <NVirtualList :items="snapshot.disks" :item-size="58" class="performance-disk-list" key-field="mountPoint">
          <template #default="{ item: disk }">
            <div class="performance-row performance-capacity-row">
              <div><span :title="`${disk.name} · ${disk.mountPoint}`">{{ diskLabel(disk) }}</span><small>{{ disk.name }} · {{ bytes(disk.available) }} 可用</small></div>
              <b>{{ percent(disk.used / Math.max(disk.total, 1) * 100) }}</b>
              <div class="performance-meter row-meter"><i :style="{ width: `${Math.min(100, disk.used / Math.max(disk.total, 1) * 100)}%` }"></i></div>
            </div>
          </template>
        </NVirtualList>
      </section>
      <section class="performance-section">
        <header class="performance-section-header"><h4>{{ t('perf.gpu') }}</h4><span>{{ snapshot.gpus.length }}</span></header>
        <p v-if="!snapshot.gpus.length" class="performance-unavailable">{{ snapshot.gpuStatus.reason || t('perf.noGpu') }}</p>
        <div v-for="gpu in snapshot.gpus" :key="gpu.name" class="performance-row performance-capacity-row">
          <div><span>{{ gpu.name }}</span><small v-if="gpu.memoryUsed != null">{{ bytes(gpu.memoryUsed) }} / {{ bytes(gpu.memoryTotal || 0) }}</small></div>
          <b>{{ gpu.memoryUsed != null && gpu.memoryTotal ? percent(gpuMemoryPercent(gpu.memoryUsed, gpu.memoryTotal)) : (gpu.utilizationPercent == null ? '—' : percent(gpu.utilizationPercent)) }}</b>
          <div v-if="gpu.memoryUsed != null && gpu.memoryTotal || gpu.utilizationPercent != null" class="performance-meter row-meter"><i :style="{ width: `${Math.min(100, gpu.memoryUsed != null && gpu.memoryTotal ? gpuMemoryPercent(gpu.memoryUsed, gpu.memoryTotal) : gpu.utilizationPercent || 0)}%` }"></i></div>
        </div>
      </section>
      <section class="performance-section performance-ports-section">
        <header class="performance-section-header"><h4>{{ t('perf.ports') }}</h4><span>{{ filteredPorts.length }}</span></header>
        <label class="performance-port-search">
          <span>{{ t('perf.searchPorts') }}</span>
          <input v-model="portQuery" type="search" inputmode="numeric" autocomplete="off" :placeholder="t('perf.searchPorts')" />
        </label>
        <p v-if="portActionError" class="performance-port-error">{{ portActionError }}</p>
        <p v-if="snapshot.portsTruncated" class="performance-unavailable">仅展示前 200 个监听端口</p>
        <p v-if="!snapshot.ports.length" class="performance-unavailable">{{ snapshot.portsStatus.reason || t('perf.noPorts') }}</p>
        <NVirtualList v-else :items="filteredPorts" :item-size="57" class="performance-port-list" key-field="port">
          <template #default="{ item: port, index }">
            <div :key="`${port.protocol}-${port.address}-${port.port}-${port.pid ?? index}-${index}`" class="performance-row performance-port-row">
              <span class="performance-protocol">{{ port.protocol }}</span><b>{{ port.port }}</b><span class="performance-port-address">{{ port.address === '*' ? '' : port.address }}</span>
              <small>{{ port.process || (port.pid ? `PID ${port.pid}` : '—') }}</small>
              <button
                class="performance-stop-port"
                :class="{ stopping: stoppingPid === port.pid }"
                :disabled="!port.pid || stoppingPid !== null"
                :data-tooltip="port.pid ? t('perf.stopPort') : 'PID unavailable'"
                @click="stopPort(port)"
                :aria-label="port.pid ? t('perf.stopPort') : 'PID unavailable'"
              ><span aria-hidden="true"></span></button>
            </div>
          </template>
        </NVirtualList>
      </section>
      <section class="performance-section performance-processes-section">
        <header class="performance-section-header"><h4>{{ t('perf.processes') }}</h4><span>{{ filteredProcesses.length }}</span></header>
        <label class="performance-port-search">
          <span>{{ t('perf.searchProcesses') }}</span>
          <input v-model="processQuery" type="search" inputmode="numeric" autocomplete="off" :placeholder="t('perf.searchProcesses')" />
        </label>
        <p v-if="!snapshot.processes.length" class="performance-unavailable">{{ snapshot.processesStatus.reason || t('perf.noProcesses') }}</p>
        <NVirtualList v-else :items="filteredProcesses" :item-size="57" class="performance-process-list" key-field="pid">
          <template #default="{ item: process }">
            <div class="performance-row performance-process-row">
              <b>{{ process.pid }}</b><span class="performance-process-name" :title="process.name">{{ process.name }}</span><span class="performance-process-cpu">{{ percent(process.cpuPercent) }} CPU</span>
              <small>{{ bytes(process.memory) }}</small>
              <button
                class="performance-stop-port"
                :class="{ stopping: stoppingPid === process.pid }"
                :disabled="stoppingPid !== null"
                :data-tooltip="t('perf.stopProcess')"
                :aria-label="t('perf.stopProcess')"
                @click="stopProcess(process)"
              ><span aria-hidden="true"></span></button>
            </div>
          </template>
        </NVirtualList>
      </section>
    </template>
    <div class="performance-resize-handle" data-tooltip="拖动缩放整体（终端+性能）" @mousedown.stop.prevent="emit('panel-resize-start', $event)"><span></span></div>
  </section>
</template>
<script src="./PerformancePanel.ts"></script>
<style src="./PerformancePanel.css" scoped></style>
