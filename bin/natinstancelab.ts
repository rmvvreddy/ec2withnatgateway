#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NatinstancelabStack } from '../lib/natinstancelab-stack';


const app = new cdk.App();
new NatinstancelabStack(app, 'NatinstancelabStack', {

});