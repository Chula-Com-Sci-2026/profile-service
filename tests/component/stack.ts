import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq'
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer, Wait } from 'testcontainers'

/**
 * The world a component test runs the service in: the image built from this checkout, and only
 * its own infrastructure around it. The same pieces as `docker-compose.yml`, on a network of their
 * own, with every host port picked by Docker, so the suite runs even while the compose stack is up.
 *
 * Nothing here comes from `src/`. The service is configured the way the team's integration stack
 * configures it: with environment variables, named as `src/infrastructure/config.ts` reads them.
 */

// The same images as docker-compose.yml. tests/unit/infrastructure/*-image.test.ts hold each pair together.
export const POSTGRES_IMAGE = 'postgres:16-alpine'
export const RABBITMQ_IMAGE = 'rabbitmq:4.3.6-management'
export const MINIO_IMAGE = 'cgr.dev/chainguard/minio@sha256:869ca3178831d9f521ea02258a0f0d4fbc1e9f84302e707514e1f861b860865d'

/**
 * The image under test, built from the repo's Dockerfile. Its own tag, never `profile-service:local`
 * (the compose stack's), and labelled so that Testcontainers' Ryuk removes it after the run.
 */
export const SERVICE_IMAGE = 'profile-service:component-test'

export const BUCKET = 'profile-service'

/**
 * How the tests sign access tokens, as Identity would. The secret is deliberately not the
 * development one compose uses, so a token the service accepts proves this setting arrived.
 */
export const TOKENS = {
  secret: 'component-suite-secret-not-the-development-default',
  issuer: 'cant-run-alone-local',
  audience: 'cant-run-alone-services',
} as const

/** The broker image's own login, which the tests use to bind their queue. The service never uses it. */
export const BROKER_ADMIN = { user: 'guest', password: 'guest' } as const

/** /ready answers 503 for this long after SIGTERM, before the server stops accepting. */
export const SHUTDOWN_DRAIN_MS = 2_000

/**
 * How long a stop waits before it kills: longer than the drain plus the service's own 10 s close
 * deadline, as compose's `stop_grace_period` is, so a graceful shutdown is never cut short.
 */
export const STOP_TIMEOUT_MS = 20_000

/** What the test files are handed, through `inject('component')`. */
export type StackAccess = {
  /** The service, as a client reaches it. */
  serviceUrl: string
  /** Object storage, as a browser reaches it — the service's OBJECT_STORAGE_PUBLIC_ENDPOINT. */
  storageUrl: string
  /** The stack's Docker network, for a scenario that starts a service of its own on it. */
  network: string
  /**
   * The broker's container. Its address is looked up when a test connects, not handed over here:
   * the outage scenario restarts it, and its host port can change when it does.
   */
  brokerContainerId: string
}

/** Profile's own broker user, granted exactly as docker-compose.yml's `create-broker-user` does. */
const BROKER_USER = { user: 'profile', password: 'profile' }
const GRANT = ['^cra\\.events$', '^cra\\.events$', '^$'] as const

const DATABASE_URL = 'postgres://profile:profile@postgres:5432/profile'
const STORAGE_LOGIN = { user: 'minioadmin', password: 'minioadmin' }

/**
 * docker-compose.yml's `create-bucket`: read-only for everyone, `s3:GetObject` and nothing else,
 * so an anonymous request can load a photo but cannot list the keys.
 */
const PUBLIC_READ = {
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${BUCKET}/*`] }],
}
const BUCKET_JOB = [
  'set -e',
  `cat > /tmp/public-read.json <<'JSON'\n${JSON.stringify(PUBLIC_READ)}\nJSON`,
  `mc alias set store http://minio:9000 ${STORAGE_LOGIN.user} ${STORAGE_LOGIN.password}`,
  `mc mb --ignore-existing store/${BUCKET}`,
  `mc anonymous set-json /tmp/public-read.json store/${BUCKET}`,
].join('\n')

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * The service's whole configuration. It reaches its neighbours by their network aliases, as in
 * compose; only the public storage endpoint is a host address, because a presigned upload URL is
 * signed over its host and the test process is the browser here.
 */
export function serviceEnvironment(storageUrl: string): Record<string, string> {
  return {
    DATABASE_URL,
    ACCESS_TOKEN_SECRET: TOKENS.secret,
    JWT_ISSUER: TOKENS.issuer,
    JWT_AUDIENCE: TOKENS.audience,
    LOG_LEVEL: 'info',
    SHUTDOWN_DRAIN_MS: String(SHUTDOWN_DRAIN_MS),
    OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
    OBJECT_STORAGE_PUBLIC_ENDPOINT: storageUrl,
    OBJECT_STORAGE_BUCKET: BUCKET,
    OBJECT_STORAGE_ACCESS_KEY: STORAGE_LOGIN.user,
    OBJECT_STORAGE_SECRET_KEY: STORAGE_LOGIN.password,
    EVENT_SENDER: 'rabbitmq',
    RABBITMQ_HOST: 'rabbitmq',
    RABBITMQ_USER: BROKER_USER.user,
    RABBITMQ_PASSWORD: BROKER_USER.password,
  }
}

/** compose's `profile-service`: the image as it ships, ready once /ready answers 200. */
export function startProfileService(network: string, storageUrl: string): Promise<StartedTestContainer> {
  return new GenericContainer(SERVICE_IMAGE)
    .withNetworkMode(network)
    .withEnvironment(serviceEnvironment(storageUrl))
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forHttp('/ready', 3000).forStatusCode(200))
    .withStartupTimeout(60_000)
    .start()
}

type Stoppable = { stop: () => Promise<unknown> }
type Track = <T extends Stoppable>(thing: T) => T

/** A one-shot job: started, waited for until it exits 0, then removed. */
async function runOnce(job: GenericContainer, track: Track): Promise<void> {
  const finished = track(await job.withWaitStrategy(Wait.forOneShotStartup()).withStartupTimeout(60_000).start())
  await finished.stop()
}

/** Built from this checkout, through BuildKit — the Dockerfile's `# syntax=` line needs it. Docker's layer cache applies. */
async function buildServiceImage(): Promise<void> {
  await GenericContainer.fromDockerfile(REPO_ROOT).withBuildkit().build(SERVICE_IMAGE, { deleteOnExit: true })
}

/** compose's `postgres`. */
async function startDatabase(network: StartedNetwork, track: Track): Promise<StartedPostgreSqlContainer> {
  return track(
    await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('profile')
      .withUsername('profile')
      .withPassword('profile')
      .withNetwork(network)
      .withNetworkAliases('postgres')
      .start(),
  )
}

/** compose's `rabbitmq` and `create-broker-user`. */
async function startBroker(network: StartedNetwork, track: Track): Promise<StartedRabbitMQContainer> {
  const broker = track(await new RabbitMQContainer(RABBITMQ_IMAGE).withNetwork(network).withNetworkAliases('rabbitmq').start())
  for (const command of [
    ['rabbitmqctl', 'add_user', BROKER_USER.user, BROKER_USER.password],
    ['rabbitmqctl', 'set_permissions', '-p', '/', BROKER_USER.user, ...GRANT],
  ]) {
    const result = await broker.exec(command)
    if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed: ${result.output}`)
  }
  return broker
}

/** compose's `minio` and `create-bucket`. The MinIO image carries `mc` and `sh`, so it runs the job too. */
async function startStorage(network: StartedNetwork, track: Track): Promise<StartedTestContainer> {
  const storage = track(
    await new GenericContainer(MINIO_IMAGE)
      .withNetwork(network)
      .withNetworkAliases('minio')
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: STORAGE_LOGIN.user, MINIO_ROOT_PASSWORD: STORAGE_LOGIN.password })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
      .start(),
  )
  await runOnce(new GenericContainer(MINIO_IMAGE).withNetwork(network).withEntrypoint(['sh', '-c']).withCommand([BUCKET_JOB]), track)
  return storage
}

/**
 * Builds the image and starts the stack around it, in compose's order: the infrastructure, then
 * the migration — the same image, run once as `node dist/migrate.js` — then the service.
 * `stop` removes everything it started, newest first, and the network last.
 */
export async function startStack(): Promise<{ access: StackAccess; stop: () => Promise<void> }> {
  const started: Stoppable[] = []
  const track: Track = (thing) => {
    started.push(thing)
    return thing
  }
  const stop = async (): Promise<void> => {
    const failures: unknown[] = []
    for (const thing of [...started].reverse()) await thing.stop().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw failures[0]
  }

  try {
    const network = track(await new Network().start())

    // All four at once, the slow image build among them. Every one settles before anything goes
    // on, so a failure still leaves each container that did start tracked, and stopped below.
    const image = buildServiceImage()
    const database = startDatabase(network, track)
    const broker = startBroker(network, track)
    const storage = startStorage(network, track)
    await Promise.allSettled([image, database, broker, storage])
    const [, , rabbitmq, minio] = await Promise.all([image, database, broker, storage])

    await runOnce(
      new GenericContainer(SERVICE_IMAGE)
        .withNetwork(network)
        .withCommand(['node', 'dist/migrate.js'])
        .withEnvironment({ DATABASE_URL }),
      track,
    )

    const storageUrl = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
    const service = track(await startProfileService(network.getName(), storageUrl))

    return {
      access: {
        serviceUrl: `http://${service.getHost()}:${service.getMappedPort(3000)}`,
        storageUrl,
        network: network.getName(),
        brokerContainerId: rabbitmq.getId(),
      },
      stop,
    }
  } catch (error) {
    await stop().catch(() => undefined)
    throw error
  }
}
