declare const hashedPasswordBrand: unique symbol;

export type HashedPassword = string & {
  readonly [hashedPasswordBrand]: "HashedPassword";
};

export const HashedPassword = Object.freeze({
  fromHash(value: string): HashedPassword {
    return value as HashedPassword;
  },
});
