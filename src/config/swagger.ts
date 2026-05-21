import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const swaggerOutputPath = path.resolve(projectRoot, 'swagger-output.json');
const sourceRoot = path.resolve(projectRoot, 'src');

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type RouteEntry = {
      method: HttpMethod;
      path: string;
      tag: string;
      summary: string;
      description: string;
      parameters?: Array<{
            name: string;
            in: 'path' | 'query' | 'header';
            required?: boolean;
            schema?: { type: string };
      }>;
};

const toPosixRelativePath = (absolutePath: string) =>
      path.relative(projectRoot, absolutePath).split(path.sep).join('/');

const cleanPathSegment = (segment: string) => segment.replace(/^\/+|\/+$/g, '');

const toTagLabel = (segment: string) => {
      const normalized = cleanPathSegment(segment);

      if (!normalized) {
            return 'General';
      }

      if (normalized.toLowerCase() === 'imei') {
            return 'IMEI';
      }

      return normalized
            .split('-')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
};

const joinPaths = (basePath: string, routePath: string) => {
      const normalizedBase = cleanPathSegment(basePath);
      const normalizedRoute = cleanPathSegment(routePath);

      const segments = [normalizedBase, normalizedRoute].filter(Boolean);

      return `/${segments.join('/')}`.replace(/\/+/g, '/');
};

const extractPathParameters = (routePath: string) =>
      [...routePath.matchAll(/:(\w+)/g)].map((match) => ({
            name: match[1],
            in: 'path' as const,
            required: true,
            schema: { type: 'string' },
      }));

const collectRouteFiles = (directoryPath: string): string[] => {
      if (!fs.existsSync(directoryPath)) {
            return [];
      }

      const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
      const routeFiles: string[] = [];

      for (const entry of entries) {
            const entryPath = path.join(directoryPath, entry.name);

            if (entry.isDirectory()) {
                  routeFiles.push(...collectRouteFiles(entryPath));
                  continue;
            }

            if (/(\.router\.ts|\.routes\.ts)$/.test(entry.name)) {
                  routeFiles.push(entryPath);
            }
      }

      return routeFiles;
};

const routeIndexPath = path.resolve(sourceRoot, 'routes/index.ts');
const routeFilePaths = collectRouteFiles(path.resolve(sourceRoot, 'modules'));

const parseMountedRoutes = async () => {
      const routeIndexSource = await fsp.readFile(routeIndexPath, 'utf8');
      const importMap = new Map<string, string>();
      const routeIndexDirectory = path.dirname(routeIndexPath);

      for (const importMatch of routeIndexSource.matchAll(
            /import\s+(\w+)\s+from\s+['"](\.\.\/modules\/[^'"]+)['"];?/g
      )) {
            const variableName = importMatch[1];
            const importPath = importMatch[2];
            const absolutePath = path.resolve(routeIndexDirectory, importPath);

            importMap.set(variableName, absolutePath.endsWith('.ts') ? absolutePath : `${absolutePath}.ts`);
      }

      const mountedRoutes = new Map<string, string[]>();

      for (const routeMatch of routeIndexSource.matchAll(
            /\{\s*path:\s*['"]([^'"]+)['"],\s*route:\s*(\w+)\s*,?\s*\}/g
      )) {
            const mountPath = routeMatch[1];
            const routeVariable = routeMatch[2];
            const routeFilePath = importMap.get(routeVariable);

            if (!routeFilePath) {
                  continue;
            }

            const existingMounts = mountedRoutes.get(routeFilePath) ?? [];
            existingMounts.push(mountPath);
            mountedRoutes.set(routeFilePath, existingMounts);
      }

      return mountedRoutes;
};

const parseRouteFile = async (routeFilePath: string, mounts: string[]): Promise<RouteEntry[]> => {
      const source = await fsp.readFile(routeFilePath, 'utf8');
      const tag = toTagLabel(path.basename(path.dirname(routeFilePath)));
      const entries: RouteEntry[] = [];

      for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"])(.*?)\2/g)) {
            const method = match[1].toLowerCase() as HttpMethod;
            const routePath = match[3];
            const parameters = extractPathParameters(routePath);

            for (const mountPath of mounts) {
                  const fullPath = joinPaths(mountPath, routePath);

                  entries.push({
                        method,
                        path: fullPath,
                        tag,
                        summary: `${method.toUpperCase()} ${fullPath}`,
                        description: `Auto-generated from ${toPosixRelativePath(routeFilePath)}.`,
                        parameters: parameters.length > 0 ? parameters : undefined,
                  });
            }
      }

      return entries;
};

const buildSwaggerDocument = async () => {
      const mountedRoutes = await parseMountedRoutes();
      const routeEntries = await Promise.all(
            routeFilePaths.map(async (routeFilePath) =>
                  parseRouteFile(routeFilePath, mountedRoutes.get(routeFilePath) ?? [])
            )
      );

      const operations = routeEntries.flat();
      const tags = Array.from(new Set(operations.map((operation) => operation.tag))).sort((left, right) =>
            left.localeCompare(right)
      );
      const paths: Record<string, Record<HttpMethod, unknown>> = {};

      for (const operation of operations) {
            if (!paths[operation.path]) {
                  paths[operation.path] = {} as Record<HttpMethod, unknown>;
            }

            paths[operation.path][operation.method] = {
                  tags: [operation.tag],
                  summary: operation.summary,
                  description: operation.description,
                  parameters: operation.parameters,
                  responses: {
                        200: {
                              description: 'Successful response',
                        },
                        default: {
                              description: 'Error response',
                        },
                  },
            };
      }

      return {
            openapi: '3.0.0',
            info: {
                  title: 'Majid 9990 Backend API',
                  description: 'Swagger documentation grouped by module routes.',
                  version: '1.0.0',
            },
            servers: [
                  {
                        url: '/api/v1',
                        description: 'API base path',
                  },
            ],
            tags: tags.map((name) => ({ name })),
            components: {
                  securitySchemes: {
                        bearerAuth: {
                              type: 'http',
                              scheme: 'bearer',
                              bearerFormat: 'JWT',
                        },
                  },
            },
            security: [{ bearerAuth: [] }],
            paths,
      };
};

export const ensureSwaggerSpec = async () => {
      const swaggerDocument = await buildSwaggerDocument();

      await fsp.writeFile(swaggerOutputPath, `${JSON.stringify(swaggerDocument, null, 2)}\n`, 'utf8');
};

export const loadSwaggerSpec = async () => {
      try {
            const content = await fsp.readFile(swaggerOutputPath, 'utf8');

            return JSON.parse(content);
      } catch {
            return buildSwaggerDocument();
      }
};

export { swaggerOutputPath };
