/**
 * Railway GraphQL client (Phase 6) — server-side ONLY.
 * Never logs or returns the API token / secret variable values.
 */
const CHISA_PROJECT_ID = process.env.CHISA_FOOD_RAILWAY_PROJECT_ID || '0296f469-4b4e-4b3f-99fb-063b03535e39';
const LAB_PROJECT_ID = '29f9f353-950f-4331-82d7-faa2565d3da1';
const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

function getToken() {
  return String(process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN || '').trim();
}

function isConfigured() {
  return !!getToken();
}

function redact(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    return obj
      .replace(/postgresql:\/\/[^\s"']+/gi, 'postgresql://***REDACTED***')
      .replace(/postgres:\/\/[^\s"']+/gi, 'postgres://***REDACTED***')
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***REDACTED***');
  }
  if (Array.isArray(obj)) return obj.map(redact);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/password|secret|token|database_url|connection.?string/i.test(k)) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return obj;
}

async function graphql(query, variables = {}) {
  const token = getToken();
  if (!token) throw new Error('RAILWAY_API_TOKEN is not configured on this server');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) {
    const msg = (json.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    const err = new Error('Railway API: ' + msg);
    err.safe = redact({ status: res.status, errors: json.errors });
    throw err;
  }
  return json.data;
}

function assertNotProtectedProject(projectId, name = '') {
  const id = String(projectId || '');
  const n = String(name || '').toLowerCase();
  if (id === CHISA_PROJECT_ID) throw new Error('Refusing to use protected Chisa Food Railway project');
  if (/chisa/.test(n)) throw new Error('Refusing Railway project name related to Chisa Food');
  // Lab control-plane project must not be overwritten as a customer project
  if (id === LAB_PROJECT_ID && /customer|provision/i.test(n)) {
    throw new Error('Refusing to treat SaaS lab control-plane as customer project');
  }
}

async function createProject({ name, workspaceId, description }) {
  assertNotProtectedProject('', name);
  const data = await graphql(
    `mutation ProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id
        name
        environments { edges { node { id name } } }
      }
    }`,
    {
      input: {
        name,
        description: description || 'Shop POS SaaS customer (Phase 6)',
        workspaceId: workspaceId || process.env.RAILWAY_WORKSPACE_ID || undefined
      }
    }
  );
  const project = data.projectCreate;
  assertNotProtectedProject(project.id, project.name);
  const env = project.environments?.edges?.[0]?.node;
  return {
    projectId: project.id,
    projectName: project.name,
    environmentId: env?.id || null,
    environmentName: env?.name || null
  };
}

async function getProject(projectId) {
  assertNotProtectedProject(projectId);
  const data = await graphql(
    `query Project($id: String!) {
      project(id: $id) {
        id
        name
        environments { edges { node { id name } } }
        services { edges { node { id name } } }
      }
    }`,
    { id: projectId }
  );
  return data.project;
}

async function createServiceFromRepo({ projectId, environmentId, name, repo, branch }) {
  assertNotProtectedProject(projectId);
  const data = await graphql(
    `mutation ServiceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId,
        environmentId: environmentId || undefined,
        name: name || 'shoppos',
        // main lacks Dockerfile (NIXPACKS/electron-builder). saas-web is the Docker web deploy branch.
        branch: branch || process.env.PROVISION_GITHUB_BRANCH || 'saas-web',
        source: { repo: repo || process.env.PROVISION_GITHUB_REPO || 'maluleke96/shop-pos' }
      }
    }
  );
  return data.serviceCreate;
}

/**
 * Force Docker web image (node server.js). Repo main railway.toml may still say NIXPACKS,
 * which runs electron-builder and breaks customer deploys.
 */
async function configureAppServiceDocker({ serviceId, environmentId }) {
  if (!serviceId || !environmentId) throw new Error('configureAppServiceDocker requires serviceId and environmentId');
  await graphql(
    `mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    {
      serviceId,
      environmentId,
      input: {
        dockerfilePath: 'Dockerfile',
        startCommand: 'node server.js',
        healthcheckPath: '/health',
        healthcheckTimeout: 300
      }
    }
  );
  return { ok: true, dockerfilePath: 'Dockerfile', startCommand: 'node server.js' };
}

/**
 * Ensure the GitHub deployment trigger points at a branch that contains Dockerfile.
 */
async function ensureDeployBranch({ projectId, environmentId, serviceId, branch, repository }) {
  assertNotProtectedProject(projectId);
  const targetBranch = branch || process.env.PROVISION_GITHUB_BRANCH || 'saas-web';
  const repo = repository || process.env.PROVISION_GITHUB_REPO || 'maluleke96/shop-pos';
  const data = await graphql(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      deploymentTriggers(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        edges { node { id branch repository } }
      }
    }`,
    { projectId, environmentId, serviceId }
  );
  const triggers = (data.deploymentTriggers?.edges || []).map((e) => e.node);
  if (triggers.length) {
    const t = triggers[0];
    if (t.branch === targetBranch) {
      return { action: 'unchanged', branch: targetBranch, triggerId: t.id };
    }
    await graphql(
      `mutation($id: String!, $input: DeploymentTriggerUpdateInput!) {
        deploymentTriggerUpdate(id: $id, input: $input) { id branch }
      }`,
      { id: t.id, input: { branch: targetBranch } }
    );
    return { action: 'updated', branch: targetBranch, triggerId: t.id };
  }
  const created = await graphql(
    `mutation($input: DeploymentTriggerCreateInput!) {
      deploymentTriggerCreate(input: $input) { id branch }
    }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        branch: targetBranch,
        repository: repo,
        provider: 'github'
      }
    }
  );
  return { action: 'created', branch: targetBranch, triggerId: created.deploymentTriggerCreate.id };
}

async function createPostgresService({ projectId, environmentId, name }) {
  assertNotProtectedProject(projectId);
  // Official Railway postgres image used by many templates
  const data = await graphql(
    `mutation ServiceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId,
        environmentId: environmentId || undefined,
        name: name || 'Postgres',
        source: { image: 'ghcr.io/railwayapp-templates/postgres-ssl:17' }
      }
    }
  );
  return data.serviceCreate;
}

async function createVolume({ projectId, environmentId, serviceId, mountPath }) {
  assertNotProtectedProject(projectId);
  try {
    const data = await graphql(
      `mutation VolumeCreate($input: VolumeCreateInput!) {
        volumeCreate(input: $input) { id name }
      }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId,
          mountPath: mountPath || '/var/lib/postgresql/data'
        }
      }
    );
    return data.volumeCreate;
  } catch (e) {
    // Volume API may vary — caller can continue and rely on image defaults
    return { skipped: true, reason: String(e.message || e).slice(0, 200) };
  }
}

async function upsertVariables({ projectId, environmentId, serviceId, variables, skipDeploys = true }) {
  assertNotProtectedProject(projectId);
  // Never send empty object
  const vars = { ...(variables || {}) };
  await graphql(
    `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables: vars,
        skipDeploys: !!skipDeploys
      }
    }
  );
  return { ok: true, keys: Object.keys(vars) };
}

async function createDomain({ environmentId, serviceId, targetPort = null }) {
  const input = { environmentId, serviceId };
  // Omit targetPort so Railway routes to the runtime PORT (often 8080).
  if (targetPort != null) input.targetPort = targetPort;
  const data = await graphql(
    `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { id domain targetPort }
    }`,
    { input }
  );
  return data.serviceDomainCreate;
}

async function updateDomainPort({ serviceDomainId, environmentId, serviceId, domain, targetPort }) {
  await graphql(
    `mutation serviceDomainUpdate($input: ServiceDomainUpdateInput!) {
      serviceDomainUpdate(input: $input)
    }`,
    {
      input: {
        serviceDomainId,
        environmentId,
        serviceId,
        domain,
        targetPort
      }
    }
  );
  return { ok: true, targetPort };
}

async function listDomains({ projectId, environmentId, serviceId }) {
  try {
    const data = await graphql(
      `query domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
        domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
          serviceDomains { id domain targetPort }
        }
      }`,
      { projectId, environmentId, serviceId }
    );
    return data.domains?.serviceDomains || [];
  } catch (_) {
    try {
      const data = await graphql(
        `query domains($environmentId: String!, $serviceId: String!) {
          domains(environmentId: $environmentId, serviceId: $serviceId) {
            serviceDomains { id domain targetPort }
          }
        }`,
        { environmentId, serviceId }
      );
      return data.domains?.serviceDomains || [];
    } catch (_) {
      return [];
    }
  }
}

async function getVariables({ projectId, environmentId, serviceId }) {
  assertNotProtectedProject(projectId);
  const data = await graphql(
    `query variables($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { projectId, environmentId, serviceId }
  );
  return data.variables || {};
}

async function deployService({ environmentId, serviceId }) {
  try {
    const data = await graphql(
      `mutation serviceInstanceDeployV2($environmentId: String!, $serviceId: String!) {
        serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId)
      }`,
      { environmentId, serviceId }
    );
    return { deploymentId: data.serviceInstanceDeployV2 };
  } catch (e) {
    // Fallback older mutation name
    try {
      const data = await graphql(
        `mutation serviceInstanceDeploy($environmentId: String!, $serviceId: String!) {
          serviceInstanceDeploy(environmentId: $environmentId, serviceId: $serviceId)
        }`,
        { environmentId, serviceId }
      );
      return { deploymentId: data.serviceInstanceDeploy };
    } catch (e2) {
      throw e;
    }
  }
}

async function getDeployment(deploymentId) {
  if (!deploymentId) return null;
  try {
    const data = await graphql(
      `query($id: String!) {
        deployment(id: $id) { id status }
      }`,
      { id: String(deploymentId) }
    );
    return data.deployment;
  } catch (_) {
    return null;
  }
}

/** Poll until SUCCESS / FAILED / CRASHED / REMOVED or timeout. */
async function waitForDeployment(deploymentId, { maxWaitMs = 8 * 60 * 1000, intervalMs = 15000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < maxWaitMs) {
    last = await getDeployment(deploymentId);
    const st = String(last?.status || '');
    if (['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(st)) {
      return { done: true, status: st, deployment: last, elapsed_ms: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return {
    done: false,
    status: last?.status || 'UNKNOWN',
    deployment: last,
    elapsed_ms: Date.now() - started,
    timed_out: true
  };
}

module.exports = {
  CHISA_PROJECT_ID,
  LAB_PROJECT_ID,
  isConfigured,
  redact,
  graphql,
  assertNotProtectedProject,
  createProject,
  getProject,
  createServiceFromRepo,
  configureAppServiceDocker,
  ensureDeployBranch,
  createPostgresService,
  createVolume,
  upsertVariables,
  createDomain,
  updateDomainPort,
  listDomains,
  getVariables,
  deployService,
  getDeployment,
  waitForDeployment,
  getTokenPresent: () => !!getToken()
};
