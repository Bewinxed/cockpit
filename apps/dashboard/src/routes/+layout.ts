import { getAgents, getInstances, getProjects } from '$lib/data.remote';

export const load = async () => {
  // Load data during SSR via remote functions
  const [agentsData, instancesData, projectsData] = await Promise.all([
    getAgents(),
    getInstances(),
    getProjects()
  ]);

  return {
    agentsData,
    instancesData,
    projectsData
  };
};
