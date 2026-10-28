import { beforeEach,describe,expect,it } from 'vitest';
import { basisPoints,cents,configureCurrency,currencyCode,currencyQuantum,currencySymbol,money,moneyStep,roundMoneyRatio,whatsappPhone } from '../src/domain/format';

beforeEach(()=>configureCurrency('PYG'));
describe('guaraníes enteros y porcentajes independientes',()=>{
  it('presenta guaraníes con símbolo local y sin centavos',()=>{
    expect(money(5_000_000)).toBe('₲ 50.000');
    expect(money(-5_000_000)).toBe('−₲ 50.000');
    expect(money(0)).toBe('₲ 0');
    expect(money(null)).toBe('Costo pendiente');
    expect(currencyCode()).toBe('PYG');
    expect(currencySymbol()).toBe('₲');
    expect(moneyStep()).toBe('1');
    expect(currencyQuantum()).toBe(100);
  });
  it('mantiene escala interna 100 y acepta solo guaraníes completos',()=>{
    expect(cents('50000')).toBe(5_000_000);
    expect(cents('50000,00')).toBe(5_000_000);
    expect(cents('0')).toBe(0);
    expect(cents('90000000000000')).toBe(9_000_000_000_000_000);
    for(const value of ['', '0,29','100.01','1.001','50.000','50.000,00','-1','Infinity','1e3','90000000000001'])expect(()=>cents(value)).toThrow();
  });
  it('conserva dos decimales en descuentos y comisiones porcentuales',()=>{
    expect(basisPoints('12,50')).toBe(1250);
    expect(basisPoints('1.25')).toBe(125);
    expect(basisPoints('100')).toBe(10_000);
    for(const value of ['100.01','1.001','-1','Infinity'])expect(()=>basisPoints(value)).toThrow();
  });
  it('redondea descuentos, comisiones y CPP a guaraníes usando enteros exactos',()=>{
    const discount=roundMoneyRatio(9_900n*1_000n,10_000n);
    expect(discount).toBe(1_000n); // 10% de ₲99: ₲9,9 -> ₲10.
    const total=9_900n-discount;
    expect(total).toBe(8_900n);
    expect(roundMoneyRatio(total*300n,10_000n)).toBe(300n); // ₲2,67 -> ₲3.
    expect(roundMoneyRatio(10_000n,3n)).toBe(3_300n);
    expect(roundMoneyRatio(500n,10n)).toBe(100n);
    expect(roundMoneyRatio(-500n,10n)).toBe(-100n);
  });
  it('conserva el tratamiento de una base antigua ARS sin convertir sus números',()=>{
    configureCurrency('ARS');
    expect(cents('0,29')).toBe(29);
    expect(cents('100.01')).toBe(10_001);
    expect(money(-125_050)).toBe('−$ 1.250,50');
    expect(currencyQuantum()).toBe(1);
    expect(moneyStep()).toBe('0.01');
    expect(roundMoneyRatio(9_900n*1_000n,10_000n)).toBe(990n);
  });
  it('prepara teléfonos paraguayos y conserva números internacionales explícitos',()=>{
    expect(whatsappPhone('0973 123456')).toBe('595973123456');
    expect(whatsappPhone('+595 973 123456')).toBe('595973123456');
    expect(whatsappPhone('00595 973 123456')).toBe('595973123456');
    expect(whatsappPhone('+54 9 11 12345678')).toBe('5491112345678');
  });
});
