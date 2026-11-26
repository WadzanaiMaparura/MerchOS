import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import { ProductApiStack } from '../lib/product-api-stack';
import { ProductIntelligenceStack } from '../lib/product-intelligence-stack';
import { SupplierIntelligenceStack } from '../lib/supplier-intelligence-stack';

const envProps = { account: '123456789012', region: 'eu-west-1' };
const app = (context: Record<string, string>) =>
  new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });

function productApi(context: Record<string, string> = {}) {
  const a = app(context);
  const deps = new cdk.Stack(a, 'Deps', { env: envProps });
  const userPool = new cognito.UserPool(deps, 'Pool');
  return Template.fromStack(
    new ProductApiStack(a, 'ProductApi', {
      env: envProps,
      environment: 'dev',
      userPool,
      sellerDashboardClient: userPool.addClient('Seller'),
      platformKey: new kms.Key(deps, 'Key'),
      eventBus: new events.EventBus(deps, 'Bus'),
    })
  );
}
const productIntelligence = (context: Record<string, string> = {}) =>
  Template.fromStack(new ProductIntelligenceStack(app(context), 'PI', { env: envProps, environment: 'dev' }));
const supplier = (context: Record<string, string> = {}) =>
  Template.fromStack(new SupplierIntelligenceStack(app(context), 'SI', { env: envProps, environment: 'dev' }));

type Fn = { Properties: { FunctionName?: string; Environment?: { Variables?: Record<string, unknown> } } };
const functionsWith = (t: Template, key: string) =>
  (Object.values(t.findResources('AWS::Lambda::Function')) as Fn[]).filter((f) => key in (f.Properties.Environment?.Variables ?? {}));
const names = (fns: Fn[]) => fns.map((f) => f.Properties.FunctionName).sort();

/** Every IAM statement across the stack that allows `action` on a resource mentioning `table`. */
function statementsFor(t: Template, action: string, table: string) {
  const out: Array<{ Action: string | string[]; Resource: unknown }> = [];
  for (const p of Object.values(t.findResources('AWS::IAM::Policy')) as Array<{
    Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> } };
  }>) {
    for (const st of p.Properties.PolicyDocument.Statement) {
      if (([] as string[]).concat(st.Action).includes(action) && JSON.stringify(st.Resource).includes(table)) out.push(st);
    }
  }
  return out;
}

describe('free-trial enforcement switch (infrastructure)', () => {
  describe('Product API', () => {
    it('is OFF by default and ON only with --context trialEnforcement=true', () => {
      const off = functionsWith(productApi(), 'TRIAL_ENFORCEMENT');
      expect(off.length).toBeGreaterThan(0);
      for (const f of off) expect(f.Properties.Environment!.Variables!['TRIAL_ENFORCEMENT']).toBe('false');
      for (const f of functionsWith(productApi({ trialEnforcement: 'true' }), 'TRIAL_ENFORCEMENT')) {
        expect(f.Properties.Environment!.Variables!['TRIAL_ENFORCEMENT']).toBe('true');
      }
    });
    it('only the exact value "true" enables it (a typo cannot silently turn enforcement on)', () => {
      for (const v of ['1', 'yes', 'TRUE', 'enabled']) {
        for (const f of functionsWith(productApi({ trialEnforcement: v }), 'TRIAL_ENFORCEMENT')) {
          expect(f.Properties.Environment!.Variables!['TRIAL_ENFORCEMENT']).toBe('false');
        }
      }
    });
    it('covers the creation and AI handlers that enforce the cap', () => {
      const n = names(functionsWith(productApi(), 'TRIAL_ENFORCEMENT'));
      expect(n).toEqual(expect.arrayContaining([
        'merch-os-product-createproduct-dev',
        'merch-os-product-synthesizeproduct-dev',
        'merch-os-product-regenerateattribute-dev',
      ]));
    });
  });

  describe('Product Intelligence', () => {
    // /usage reads the entitlement too: the token budget is sized from the plan.
    it('gives ONLY /generate, /batch and /usage the gate env, defaulting to off', () => {
      const t = productIntelligence();
      const fns = functionsWith(t, 'TRIAL_ENFORCEMENT');
      expect(fns).toHaveLength(3);
      for (const f of fns) {
        expect(f.Properties.Environment!.Variables!['TRIAL_ENFORCEMENT']).toBe('false');
        expect(f.Properties.Environment!.Variables).toHaveProperty('PRODUCTS_TABLE');
      }
      expect(names(fns).join()).toMatch(/generate/i);
      expect(names(fns).join()).toMatch(/batch/i);
      expect(names(fns).join()).toMatch(/usage/i);
    });
    it('turns on with the context flag', () => {
      for (const f of functionsWith(productIntelligence({ trialEnforcement: 'true' }), 'TRIAL_ENFORCEMENT')) {
        expect(f.Properties.Environment!.Variables!['TRIAL_ENFORCEMENT']).toBe('true');
      }
    });
    it('can only READ the products table (GetItem): it never writes entitlements', () => {
      const t = productIntelligence();
      const get = statementsFor(t, 'dynamodb:GetItem', 'merch-os-products-dev');
      expect(get.length).toBeGreaterThan(0);
      for (const st of get) {
        expect(JSON.stringify(st.Resource)).toContain('table/merch-os-products-dev');
        for (const a of ([] as string[]).concat(st.Action)) expect(a).toBe('dynamodb:GetItem');
      }
      for (const a of ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem']) {
        expect(statementsFor(t, a, 'merch-os-products-dev')).toHaveLength(0);
      }
    });
  });

  describe('Supplier Intelligence', () => {
    it('gives only the ProductPersister the gate env, defaulting to off', () => {
      const t = supplier();
      const fns = functionsWith(t, 'TRIAL_ENFORCEMENT');
      expect(fns).toHaveLength(1);
      expect(names(fns)[0]).toMatch(/productpersister/);
      expect(fns[0]!.Properties.Environment!.Variables!['TRIAL_ENFORCEMENT']).toBe('false');
      expect(functionsWith(supplier({ trialEnforcement: 'true' }), 'TRIAL_ENFORCEMENT')[0]!.Properties.Environment!.Variables!['TRIAL_ENFORCEMENT']).toBe('true');
    });
    it('can reserve/release trial slots: GetItem + DeleteItem on the products table, in addition to its writes', () => {
      const t = supplier();
      expect(statementsFor(t, 'dynamodb:GetItem', 'merch-os-products-dev').length).toBeGreaterThan(0);
      expect(statementsFor(t, 'dynamodb:DeleteItem', 'merch-os-products-dev').length).toBeGreaterThan(0);
      expect(statementsFor(t, 'dynamodb:BatchWriteItem', 'merch-os-products-dev').length).toBeGreaterThan(0);
    });
  });
});

describe('free trial usage for the seller bell', () => {
  it('only product create may tell the platform bus (product.trial.usage)', () => {
    const t = productApi();
    const withBus = (Object.values(t.findResources('AWS::Lambda::Function')) as Fn[]).filter(
      (f) => f.Properties.Environment?.Variables?.['EVENT_BUS_NAME'] === 'merch-os-events-dev',
    );
    expect(names(withBus)).toEqual(['merch-os-product-createproduct-dev']);
    const puts = statementsFor(t, 'events:PutEvents', 'event-bus/merch-os-events-dev');
    expect(puts).toHaveLength(1);
  });
});
