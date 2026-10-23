// Resolve the emitted .js spelling when exercising the original TypeScript source.
// Production builds keep normal .js imports; Node 24 provides native type stripping.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || !specifier.endsWith('.js') || !context.parentURL?.endsWith('.ts')) throw error;
      const source = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (!existsSync(source)) throw error;
      return nextResolve(source.href, context);
    }
  },
});

export const loadContract = name => import(new URL(`../contracts/${name}.ts`, import.meta.url));
