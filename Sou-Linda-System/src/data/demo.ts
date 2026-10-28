import { mutate } from './api';
export async function seedDemo():Promise<void>{await mutate('/demo',{});}
