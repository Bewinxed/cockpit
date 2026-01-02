<script lang="ts">
  interface Props {
    width?: string;
    height?: string;
    rounded?: 'sm' | 'md' | 'lg' | 'full';
    class?: string;
  }

  let {
    width = '100%',
    height = '1rem',
    rounded = 'md',
    class: className = '',
  }: Props = $props();

  const roundedClasses = {
    sm: 'rounded',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  };
</script>

<div
  class="skeleton {roundedClasses[rounded]} {className}"
  style="width: {width}; height: {height};"
  aria-hidden="true"
></div>
