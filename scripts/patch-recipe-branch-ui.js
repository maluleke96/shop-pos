const fs = require('fs');
const p = require('path').join(__dirname, '..', 'src', 'js', 'recipe-production', 'app.js');
let s = fs.readFileSync(p, 'utf8');
const pairs = [
  ['API.recipeMealProducts(filters, this.user)', 'API.recipeMealProducts({ ...filters, ...this.branchFilter() }, this.user)'],
  ['API.recipeMealProducts({ with_recipe: true }, this.user)', 'API.recipeMealProducts({ with_recipe: true, ...this.branchFilter() }, this.user)'],
  ['API.recipeMealProducts({}, this.user)', 'API.recipeMealProducts({ ...this.branchFilter() }, this.user)'],
  ['API.recipeBatches({}, this.user)', 'API.recipeBatches({ ...this.branchFilter() }, this.user)'],
  ["API.recipeList({ status: 'pending' }, this.user)", "API.recipeList({ status: 'pending', ...this.branchFilter() }, this.user)"],
  ["API.recipeList({ status: 'approved' }, this.user)", "API.recipeList({ status: 'approved', ...this.branchFilter() }, this.user)"],
  ['API.recipeProductionMeals(this.user)', 'API.recipeProductionMeals(this.user, this.branchFilter())']
];
for (const [a, b] of pairs) {
  if (!s.includes(a)) console.log('MISS', a);
  else {
    s = s.split(a).join(b);
    console.log('OK', a.slice(0, 50));
  }
}
// Also stamp branch on meal/recipe saves when collecting payload
if (!s.includes('...this.branchFilter()') || !s.includes('branch_id: this.branchId')) {
  s = s.replace(
    /const payload = \{([\s\S]*?)product_id:/,
    (m) => m.includes('branch_id') ? m : m.replace('const payload = {', 'const payload = {\n        ...this.branchFilter(),')
  );
}
fs.writeFileSync(p, s);
console.log('done');
