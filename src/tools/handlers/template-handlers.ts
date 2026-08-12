import type { OjoApiClient } from '../../server/ojo-client.js';
import type {
  CreateTemplateArgs,
  GetTemplateArgs,
  ListTemplatesArgs,
} from '../schema.js';
import { textResult, toErrorResult } from '../result.js';

export function makeListTemplates(client: OjoApiClient) {
  return async (args: ListTemplatesArgs) => {
    try {
      const result = await client.listTemplates(args);
      return textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeGetTemplate(client: OjoApiClient) {
  return async (args: GetTemplateArgs) => {
    try {
      const result = await client.getTemplate(args.templateId);
      return textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeCreateTemplate(client: OjoApiClient) {
  return async (args: CreateTemplateArgs) => {
    try {
      const result = await client.createTemplate(args.html, args.variables);
      return textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return toErrorResult(error);
    }
  };
}
