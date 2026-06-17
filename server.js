const app = require("./api/index.js");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Food Feedback API server running on port ${PORT}`);
});
