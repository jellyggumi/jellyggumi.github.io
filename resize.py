from PIL import Image
import os 

def resize_images_from_folder(folder_path,size=(2048, 2048)):
    """
    지정된 폴더에서 이미지를 읽어오는 함수.

    Parameters:
        folder_path (str): 이미지가 저장된 폴더 경로.

    Returns:
        list: Image 객체들의 리스트.
    """
    # images = []
    try:
        # 폴더의 모든 파일 탐색
        for file_name in os.listdir(folder_path):
            file_path = os.path.join(folder_path, file_name)
            # 파일이 이미지인지 확인 후 읽기
            if os.path.isfile(file_path) and file_name.lower().endswith(('png', 'jpg', 'jpeg', 'bmp', 'gif')):
                try:
                    img = Image.open(file_path)  # 이미지 열기
                    resized_img = img.resize(size)
                    # images.append(img)
                    # Save the resized image
                    resized_img.save(file_path)
                    print(f"이미지 로드 성공: {file_name}")
                except Exception as e:
                    print(f"이미지 로드 실패: {file_name}, 오류: {e}")
    except Exception as e:
        print(f"폴더를 읽는 중 오류가 발생했습니다: {e}")

    # return images

# Function to resize an image
def resize_image(input_path, output_path, size=(1024, 1024)):
    """
    Resize an image to the specified size.
    
    Parameters:
        input_path (str): Path to the input image.
        output_path (str): Path to save the resized image.
        size (tuple): New size as a tuple (width, height).
    """
    try:
        # Open the image
        with Image.open(input_path) as img:
            # Resize the image
            original_width, original_height = img.size
            max_width, max_height = size

            # 가로와 세로 비율 계산
            aspect_ratio = original_width / original_height

            if original_width > original_height:
                # 가로가 더 긴 경우
                new_width = min(original_width, max_width)
                new_height = int(new_width / aspect_ratio)
            else:
                # 세로가 더 긴 경우
                new_height = min(original_height, max_height)
                new_width = int(new_height * aspect_ratio)

            # 이미지 리사이즈
            resized_img = img.resize((new_width, new_height), Image.ANTIALIAS)
            # Save the resized image
            resized_img.save(output_path)
            
            print(f"Image resized and saved to {output_path}")
    except Exception as e:
        print(f"Error resizing image: {e}")

folder_dir = r"./gallery/archive/g03"

resize_images_from_folder(folder_path=folder_dir)

# # Example usage
# input_image_path = "INA_water.png"  # Replace with the path to your input image
# output_image_path = "INA.png"     # Replace with the path to save the resized image

# resize_image(input_image_path, output_image_path)