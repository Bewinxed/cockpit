import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  try {
    // Fetch instance data from API
    const instanceRes = await fetch(`/api/instances/${params.id}`);
    if (!instanceRes.ok) {
      return { instance: null, messages: [], error: 'Instance not found' };
    }
    const instanceData = await instanceRes.json();

    // Fetch messages for this instance
    const messagesRes = await fetch(`/api/instances/${params.id}/messages`);
    let messages: unknown[] = [];
    if (messagesRes.ok) {
      const messagesData = await messagesRes.json();
      messages = messagesData.data || [];
    }

    return {
      instance: instanceData.data,
      messages,
      error: null,
    };
  } catch (err) {
    console.error('Failed to load instance:', err);
    return { instance: null, messages: [], error: 'Failed to load instance' };
  }
};
