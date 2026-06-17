import json
import requests
import time

api_key = "AIzaSyCHjpIOkPuX3hbCcXtHydlXjUBExyzcqgY"
project_id = "ecity-food-feedback-2026"
json_path = r"F:\Projects\Food Feedback\student_data.json"

url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents:commit?key={api_key}"

def upload_in_batches():
    print("Loading student data...")
    with open(json_path, 'r', encoding='utf-8') as f:
        students = json.load(f)

    total_students = len(students)
    batch_size = 400  # Firestore batch limit is 500, we use 400 for safety
    print(f"Total students to upload: {total_students}. Batch size: {batch_size}")

    for i in range(0, total_students, batch_size):
        batch = students[i:i + batch_size]
        writes = []
        for s in batch:
            scs_number = s['scsNumber']
            if not scs_number:
                continue
            
            # Formulate the fields dictionary
            fields = {
                "scsNumber": {"stringValue": str(scs_number)},
                "studentName": {"stringValue": str(s.get('studentName') or '')},
                "category": {"stringValue": str(s.get('category') or '')},
                "section": {"stringValue": str(s.get('section') or '')},
                "campus": {"stringValue": str(s.get('campus') or '')}
            }
            
            doc_name = f"projects/{project_id}/databases/(default)/documents/students/{scs_number}"
            write_op = {
                "update": {
                    "name": doc_name,
                    "fields": fields
                }
            }
            writes.append(write_op)

        payload = {"writes": writes}
        print(f"Uploading batch {i // batch_size + 1} ({len(writes)} records)...")
        
        try:
            response = requests.post(url, json=payload)
            if response.status_code == 200:
                print(f"Batch {i // batch_size + 1} uploaded successfully!")
            else:
                print(f"Error on batch {i // batch_size + 1}: Status {response.status_code}")
                print(response.text)
                print("\nIMPORTANT: Please ensure Firestore is enabled in your Firebase Console:")
                print(f"https://console.firebase.google.com/project/{project_id}/firestore")
                return
        except Exception as e:
            print(f"Failed to upload batch {i // batch_size + 1}: {e}")
            return
        
        # Avoid hitting rate limits
        time.sleep(0.5)

    print("Data upload process completed.")

if __name__ == "__main__":
    upload_in_batches()
