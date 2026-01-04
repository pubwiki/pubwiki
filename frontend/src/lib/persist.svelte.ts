import { onMount } from 'svelte';

export default function persist<T>(key: string, initialValue: T) {
  let value = $state<T>(initialValue);

  onMount(() => {
    const currentValue = localStorage.getItem(key);
    if (currentValue) value = JSON.parse(currentValue);
  });

  const save = () => {
    if (value) {
      localStorage.setItem(key, JSON.stringify(value));
    } else {
      localStorage.removeItem(key);
    }
  };

  return {
    get value() {
      return value;
    },
    set value(v: T) {
      value = v;
      save();
    },
  };
};
