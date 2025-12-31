<script lang="ts">
  interface Props {
    icon: string;
    count: number | string;
    label: string;
    trend: string;
    color?: 'blue' | 'green' | 'purple' | 'orange' | 'cyan' | 'red';
  }

  let { icon, count, label, trend, color = 'blue' }: Props = $props();

  const colorClasses = {
    blue: 'bg-flexoki-blue/10 text-flexoki-blue',
    green: 'bg-flexoki-green/10 text-flexoki-green',
    purple: 'bg-flexoki-purple/10 text-flexoki-purple',
    orange: 'bg-flexoki-orange/10 text-flexoki-orange',
    cyan: 'bg-flexoki-cyan/10 text-flexoki-cyan',
    red: 'bg-flexoki-red/10 text-flexoki-red',
  };
</script>

<div class="card hover-lift group">
  <div class="flex items-start justify-between mb-3">
    <div class="w-10 h-10 rounded-lg flex items-center justify-center text-lg {colorClasses[color]} transition-transform group-hover:scale-110">
      {icon}
    </div>
    <span class="text-xs text-tx-3">{trend}</span>
  </div>
  <div class="text-2xl font-semibold text-tx-1 mb-1">{count}</div>
  <div class="text-sm text-tx-2">{label}</div>
</div>
